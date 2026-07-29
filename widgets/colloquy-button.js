/**
 * Colloquy Hermes UI Button & Modal Component
 * Imports colloquy-hermes-widget.js and renders a top-bar launch button.
 */
import './colloquy-hermes-widget.js';

class ColloquyHermesButton extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isOpen = false;
  }

  connectedCallback() {
    this.render();
  }

  toggleDrawer() {
    this.isOpen = !this.isOpen;
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: inline-block;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          position: relative;
        }
        .nav-btn {
          background: ${this.isOpen ? '#ff9900' : '#1a1d2e'};
          color: ${this.isOpen ? '#000000' : '#ffcc66'};
          border: 1px solid #ff9900;
          border-radius: 6px;
          padding: 6px 12px;
          font-family: inherit;
          font-weight: bold;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }
        .nav-btn:hover {
          background: #ffcc66;
          color: #000;
        }
        .drawer {
          display: ${this.isOpen ? 'block' : 'none'};
          position: absolute;
          top: 40px;
          right: 0;
          z-index: 9999;
          width: 580px;
          filter: drop-shadow(0px 10px 25px rgba(0,0,0,0.85));
        }
      </style>

      <button class="nav-btn">
        <span>🖖</span> Colloquy Flight Deck
      </button>

      <div class="drawer">
        <colloquy-hermes-widget></colloquy-hermes-widget>
      </div>
    `;

    this.shadowRoot.querySelector('.nav-btn').addEventListener('click', () => this.toggleDrawer());
  }
}

customElements.define('colloquy-hermes-button', ColloquyHermesButton);
