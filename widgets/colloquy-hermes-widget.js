/**
 * Colloquy Causal DAG & Swarm Control - Hermes Dashboard Widget
 * Compatible with Hermes Agent Desktop & Web UI Panel
 */

class ColloquyHermesWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = {
      connected: true,
      cacheTTL: 52,
      activeNode: "0x00A-SESS-HUMAN",
      ideas: [
        "Interactive Decision Walker",
        "State Diffing View",
        "Counterfactual Replay Stepper",
        "Export to Markdown (.md)",
        "1-Click Gist Creation"
      ],
      dagNodes: [
        { id: "0x00A-SESS-HUMAN", intent: "Refactor DB Index Strategy", tool: "execute_sql_patch", status: "VERIFIED" },
        { id: "0x00B-AGENT-WORKER", intent: "Scaffold /lib module code", tool: "fs_write_file", status: "VERIFIED" },
        { id: "0x009-FORK-CHILD", intent: "Counterfactual Branch", tool: "sandbox_exec", status: "PENDING" }
      ]
    };
  }

  connectedCallback() {
    this.render();
    this.setupListeners();
  }

  slurpIdea(title, index) {
    // Dispatch Herdr / Hermes event to trigger background worker slurp
    const event = new CustomEvent('hermes:action', {
      bubbles: true,
      composed: true,
      detail: {
        action: 'SLURP_IDEA',
        idea: title,
        timestamp: new Date().toISOString()
      }
    });
    this.dispatchEvent(event);

    // Update local widget state
    this.state.ideas.splice(index, 1);
    this.render();
  }

  setupListeners() {
    this.shadowRoot.addEventListener('click', (e) => {
      if (e.target.classList.contains('slurp-btn')) {
        const index = parseInt(e.target.dataset.index, 10);
        const title = e.target.dataset.title;
        this.slurpIdea(title, index);
      }
    });
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          background: #0d0e15;
          color: #ffcc66;
          border: 1px solid #ff9900;
          border-radius: 8px;
          padding: 16px;
          max-width: 650px;
          box-shadow: 0 4px 20px rgba(255, 153, 0, 0.15);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #ff9900;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .title {
          font-weight: bold;
          color: #ff9900;
          font-size: 14px;
        }
        .badge {
          background: #33cc66;
          color: #000;
          font-size: 10px;
          font-weight: bold;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .section-title {
          font-size: 11px;
          color: #66ccff;
          margin-top: 12px;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .dag-container {
          background: #141622;
          border-radius: 6px;
          padding: 10px;
          border: 1px solid #1f2338;
        }
        .dag-node {
          margin-bottom: 8px;
          padding: 6px 8px;
          border-left: 3px solid #33cc66;
          background: #1a1d2e;
          font-size: 12px;
        }
        .dag-node.pending {
          border-left-color: #ff6666;
        }
        .node-id {
          color: #cc99ff;
          font-weight: bold;
        }
        .node-intent {
          color: #66ccff;
        }
        .node-meta {
          color: #888;
          font-size: 10px;
        }
        .inbox-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .inbox-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #141622;
          padding: 6px 10px;
          margin-bottom: 4px;
          border-radius: 4px;
          font-size: 12px;
        }
        .slurp-btn {
          background: #ff9900;
          color: #000;
          border: none;
          padding: 2px 8px;
          font-weight: bold;
          font-size: 10px;
          border-radius: 3px;
          cursor: pointer;
        }
        .slurp-btn:hover {
          background: #ffcc66;
        }
      </style>

      <div class="header">
        <span class="title">🖖 COLLOQUY HERMES WIDGET</span>
        <span class="badge">HERDR AGENT MULTIPLEXER</span>
      </div>

      <div class="section-title">🧬 Causal Execution DAG</div>
      <div class="dag-container">
        ${this.state.dagNodes.map(node => `
          <div class="dag-node ${node.status === 'PENDING' ? 'pending' : ''}">
            <div><span class="node-id">${node.id}</span> ➔ <span class="node-intent">"${node.intent}"</span></div>
            <div class="node-meta">🔐 Tool: ${node.tool} | Status: ${node.status}</div>
          </div>
        `).join('')}
      </div>

      <div class="section-title">💡 Ideas Backlog Inbox</div>
      <ul class="inbox-list">
        ${this.state.ideas.map((idea, idx) => `
          <li class="inbox-item">
            <span>💡 ${idea}</span>
            <button class="slurp-btn" data-index="${idx}" data-title="${idea}">[S] SLURP</button>
          </li>
        `).join('')}
      </ul>
    `;
  }
}

customElements.define('colloquy-hermes-widget', ColloquyHermesWidget);
