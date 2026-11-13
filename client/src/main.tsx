import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import './styles.css';
import { Lobby } from './Lobby';
import { TablePage } from './table/TablePage';

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = (p: string) => { history.pushState(null, '', p); setPath(p); };
  const m = path.match(/^\/t\/([a-z0-9]+)/i);
  return m ? <TablePage key={m[1]} tableId={m[1]} navigate={navigate} /> : <Lobby navigate={navigate} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
