import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RtcPeer } from '../../../shared/types';
import { call, socket } from './socket';

/*
 * Full-mesh WebRTC between everyone at the table, using the "perfect negotiation"
 * pattern. Signalling goes through the game server; media goes peer-to-peer, or
 * through the TURN relay when a direct path is impossible.
 */

type Kind = 'audio' | 'video';

interface Peer {
  socketId: string;
  playerId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: Partial<Record<Kind, RTCRtpSender>>;
  remote: MediaStream;
}

interface Snapshot {
  local: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  streams: Record<string, MediaStream>;
  speaking: Record<string, boolean>;
  error: string | null;
  busy: boolean;
}

class MediaMesh {
  private peers = new Map<string, Peer>();
  private iceServers: RTCIceServer[] | null = null;
  private local: MediaStream | null = null;
  private listeners = new Set<() => void>();
  private snap: Snapshot = { local: null, camOn: false, micOn: false, streams: {}, speaking: {}, error: null, busy: false };
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { node: AnalyserNode; src: MediaStreamAudioSourceNode; trackId: string }>();
  private meterTimer: number | null = null;
  myPlayerId: string | null = null;

  constructor() {
    socket.on('rtc:peers', (peers: RtcPeer[]) => void this.setPeers(peers));
    socket.on('rtc:signal', (m: { from: string; data: SignalData }) => void this.onSignal(m.from, m.data));
    socket.on('disconnect', () => { for (const id of [...this.peers.keys()]) this.closePeer(id); this.emit(); });
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = () => this.snap;

  private emit(patch: Partial<Snapshot> = {}) {
    const streams: Record<string, MediaStream> = {};
    for (const p of this.peers.values()) if (p.remote.getTracks().length) streams[p.playerId] = p.remote;
    this.snap = {
      ...this.snap,
      ...patch,
      local: this.local,
      camOn: !!this.local?.getVideoTracks().some((t) => t.readyState === 'live'),
      micOn: !!this.local?.getAudioTracks().some((t) => t.readyState === 'live' && t.enabled),
      streams,
    };
    this.listeners.forEach((l) => l());
    this.syncMeters();
  }

  private async config(): Promise<RTCIceServer[]> {
    if (this.iceServers) return this.iceServers;
    try {
      const res = await fetch('/api/rtc-config');
      this.iceServers = (await res.json()).iceServers as RTCIceServer[];
    } catch {
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }
    return this.iceServers;
  }

  private async setPeers(list: RtcPeer[]) {
    const me = socket.id;
    const wanted = new Map(list.filter((p) => p.socketId !== me).map((p) => [p.socketId, p]));
    for (const id of [...this.peers.keys()]) if (!wanted.has(id)) this.closePeer(id);
    if (!this.myPlayerId) { this.emit(); return; }
    for (const p of wanted.values()) {
      if (!this.peers.has(p.socketId)) await this.openPeer(p);
      else this.peers.get(p.socketId)!.playerId = p.playerId;
    }
    this.emit();
  }

  private async openPeer(info: RtcPeer) {
    const pc = new RTCPeerConnection({ iceServers: await this.config() });
    if (this.peers.has(info.socketId)) { pc.close(); return; }
    const peer: Peer = {
      socketId: info.socketId, playerId: info.playerId, pc, polite: (socket.id ?? '') < info.socketId,
      makingOffer: false, ignoreOffer: false, senders: {}, remote: new MediaStream(),
    };
    this.peers.set(info.socketId, peer);
    const send = (data: SignalData) => socket.emit('rtc:signal', { to: info.socketId, data });

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        send({ description: pc.localDescription!.toJSON() });
      } catch (e) {
        console.warn('[rtc] offer failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ candidate: candidate.toJSON() }); };
    pc.ontrack = ({ track }) => {
      for (const t of peer.remote.getTracks()) if (t.kind === track.kind && t.id !== track.id) peer.remote.removeTrack(t);
      if (!peer.remote.getTracks().includes(track)) peer.remote.addTrack(track);
      peer.remote = new MediaStream(peer.remote.getTracks());
      track.onunmute = () => this.emit();
      track.onended = () => this.emit();
      this.emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
    this.attachLocal(peer);
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
  }

  private async onSignal(from: string, data: SignalData) {
    const peer = this.peers.get(from);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          socket.emit('rtc:signal', { to: from, data: { description: pc.localDescription!.toJSON() } });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch (e) {
      console.warn('[rtc] signal error', e);
    }
  }

  private attachLocal(peer: Peer) {
    if (!this.local) return;
    for (const track of this.local.getTracks()) {
      const kind = track.kind as Kind;
      const s = peer.senders[kind];
      if (s) void s.replaceTrack(track);
      else peer.senders[kind] = peer.pc.addTrack(track, this.local);
    }
  }

  private async acquire(kind: Kind) {
    const constraints: MediaStreamConstraints = kind === 'video'
      ? { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 }, facingMode: 'user' } }
      : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    const track = kind === 'video' ? s.getVideoTracks()[0] : s.getAudioTracks()[0];
    if (!this.local) this.local = new MediaStream();
    for (const old of this.local.getTracks()) if (old.kind === kind) { old.stop(); this.local.removeTrack(old); }
    this.local.addTrack(track);
    this.local = new MediaStream(this.local.getTracks());
    for (const p of this.peers.values()) {
      const sender = p.senders[kind];
      if (sender) await sender.replaceTrack(track);
      else p.senders[kind] = p.pc.addTrack(track, this.local);
    }
  }

  private release(kind: Kind) {
    if (!this.local) return;
    for (const t of this.local.getTracks()) if (t.kind === kind) { t.stop(); this.local.removeTrack(t); }
    for (const p of this.peers.values()) void p.senders[kind]?.replaceTrack(null);
    this.local = this.local.getTracks().length ? new MediaStream(this.local.getTracks()) : null;
  }

  async setCam(on: boolean) { await this.toggle('video', on); }
  async setMic(on: boolean) {
    // Keep the mic track alive once granted; muting just disables it (no re-prompt, instant).
    const t = this.local?.getAudioTracks()[0];
    if (t && t.readyState === 'live') { t.enabled = on; this.emit(); this.report(); return; }
    await this.toggle('audio', on);
  }

  private async toggle(kind: Kind, on: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.emit({ error: 'Camera and microphone need a secure (https) connection.' });
      return;
    }
    this.emit({ busy: true, error: null });
    try {
      if (on) await this.acquire(kind);
      else this.release(kind);
      this.emit({ busy: false });
    } catch (e) {
      const name = (e as DOMException)?.name;
      const msg = name === 'NotAllowedError'
        ? `${kind === 'video' ? 'Camera' : 'Microphone'} access was blocked. Allow it in the browser's address bar and try again.`
        : name === 'NotFoundError'
          ? `No ${kind === 'video' ? 'camera' : 'microphone'} found on this device.`
          : `Could not start the ${kind === 'video' ? 'camera' : 'microphone'}.`;
      this.emit({ busy: false, error: msg });
    }
    this.report();
  }

  private report() {
    void call('player:media', { camOn: this.snap.camOn, micOn: this.snap.micOn }).catch(() => {});
  }

  clearError() { this.emit({ error: null }); }

  /** Called when we learn (or lose) our player identity at this table. */
  setIdentity(playerId: string | null) {
    if (this.myPlayerId === playerId) return;
    this.myPlayerId = playerId;
    if (!playerId) { for (const id of [...this.peers.keys()]) this.closePeer(id); this.emit(); }
    else if (this.snap.camOn || this.snap.micOn) this.report();
  }

  /* ---- speaking meters ---- */

  private syncMeters() {
    const wanted = new Map<string, MediaStream>();
    if (this.local && this.myPlayerId) wanted.set(this.myPlayerId, this.local);
    for (const [pid, s] of Object.entries(this.snap.streams)) wanted.set(pid, s);
    for (const [pid, s] of wanted) {
      const track = s.getAudioTracks()[0];
      const cur = this.analysers.get(pid);
      if (!track) { if (cur) { cur.src.disconnect(); this.analysers.delete(pid); } continue; }
      if (cur?.trackId === track.id) continue;
      if (!this.audioCtx) {
        try { this.audioCtx = new AudioContext(); } catch { return; }
      }
      if (cur) cur.src.disconnect();
      const src = this.audioCtx.createMediaStreamSource(new MediaStream([track]));
      const node = this.audioCtx.createAnalyser();
      node.fftSize = 512;
      src.connect(node);
      this.analysers.set(pid, { node, src, trackId: track.id });
    }
    for (const pid of [...this.analysers.keys()]) if (!wanted.has(pid)) { this.analysers.get(pid)!.src.disconnect(); this.analysers.delete(pid); }
    if (this.analysers.size && this.meterTimer == null) this.meterTimer = window.setInterval(this.measure, 160);
    if (!this.analysers.size && this.meterTimer != null) { clearInterval(this.meterTimer); this.meterTimer = null; }
  }

  private buf = new Uint8Array(512);
  private measure = () => {
    if (this.audioCtx?.state === 'suspended') void this.audioCtx.resume();
    const speaking: Record<string, boolean> = {};
    let changed = false;
    for (const [pid, a] of this.analysers) {
      a.node.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / this.buf.length);
      const muted = pid === this.myPlayerId && !this.snap.micOn;
      speaking[pid] = !muted && rms > 0.035;
      if (speaking[pid] !== !!this.snap.speaking[pid]) changed = true;
    }
    if (changed) { this.snap = { ...this.snap, speaking }; this.listeners.forEach((l) => l()); }
  };
}

interface SignalData { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }

export const mesh = new MediaMesh();

export function useMedia() {
  return useSyncExternalStore(mesh.subscribe, mesh.getSnapshot);
}

/** Re-render once a second while something time-based is on screen. */
export function useNow(active = true, interval = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [active, interval]);
  return now;
}
