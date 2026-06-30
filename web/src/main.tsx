import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './components.css';

// NOTE: intentionally no <StrictMode>. It double-invokes effects in dev, which
// double-initializes the imperative WebGL splat viewer. Not worth the headache.
createRoot(document.getElementById('root')!).render(<App />);
