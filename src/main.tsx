import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useLoom } from './state';
import './styles.css';

// development only: lets automated tests jump between scenes (stripped from production builds)
if (import.meta.env.DEV) (window as unknown as { __loom: typeof useLoom }).__loom = useLoom;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
