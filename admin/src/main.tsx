import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Editor } from './Editor';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App renderEditor={(p) => <Editor key={p.id} {...p} />} />
  </StrictMode>,
);
