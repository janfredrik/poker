# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Node.js + TypeScript server (Socket.IO) owning all game logic, React + Vite client. Shipped as one Docker image for Unraid, running behind the owner's existing nginx reverse proxy. A coturn container in the same compose file relays WebRTC media when peers cannot connect directly.

## Purpose

A self-hosted, private alternative to PokerNow for home games with friends. The host creates a No-Limit Texas Hold'em table, sets blinds and a blind clock, and shares a link. Friends open the link, pick a name and a starting stack, and sit down. The server deals, enforces betting rules, runs the blind levels, and settles pots, so nobody needs physical cards or chips. Players can see and hear each other through built-in camera and microphone.

## Users

- **Host (table owner):** one of the friends. Creates the table, chooses blinds and level length, approves or seats players, starts/pauses the game, adjusts stacks (rebuys), and keeps the ledger honest.
- **Players:** friends joining from a shared link on laptop or phone, usually in the evening, often on a video call. They want to act quickly on their turn and always know pot, stacks, whose turn it is, and the current blinds.

## Core capabilities

- Create table: name, small/big blind, starting stack, blind-level duration and schedule.
- Join by link: name + buy-in amount; no accounts.
- Full NLH engine: dealer button, blinds, preflop/flop/turn/river, check/call/bet/raise/fold/all-in, side pots, showdown with hand evaluation, split pots.
- Blind clock that raises blinds on schedule; host can pause.
- Ledger: buy-ins, rebuys, and net results per player.
- Per-player camera and microphone over WebRTC (mesh), with mute/camera toggles.
- Table state persisted to disk so a container restart does not end the night.

## Constraints

- No accounts or passwords; identity is a per-browser token tied to a seat.
- Must work behind nginx (WebSocket upgrade) on a subpath-free hostname.
- Play money only. No real-money handling, payments, or gambling integration.
- UI language: English, using standard poker terminology.
- Up to 9 seats per table.
- Players are mostly on laptops/desktops; phones must work but are secondary.
- Faces matter: video is part of the table, not a hidden extra.

## Open decisions


- Whether spectators can watch without a seat.
