import { createRoot } from 'react-dom/client';
import { App } from './App';
import './tokens.css';
import './styles.css';
import './tooltip.css';
import { applyCachedTheme } from './theme';

applyCachedTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado');
}

createRoot(container).render(<App />);
