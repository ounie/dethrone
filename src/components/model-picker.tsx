"use client";

import type { AgentConfig, ProviderId } from "@/lib/agent";

/**
 * Which model is thinking, and on whose account.
 *
 * The list is computed on the server and shipped as data, exactly as the
 * command capabilities are. **There is no field here to paste an API key into**,
 * and there will not be one: a credential in the browser is the one thing this
 * console's trust boundary exists to prevent, and a chat pane is not the place
 * to make an exception. Keys live in `.env.local` beside the wallet key.
 *
 * An unavailable provider renders disabled with the server's own sentence —
 * the same treatment a paid command gets on a keyless deploy, because it is the
 * same kind of fact.
 */
export default function ModelPicker({
  agent,
  providerId,
  modelId,
  disabled,
  onChange,
}: {
  agent: AgentConfig;
  providerId: ProviderId | null;
  modelId: string;
  disabled: boolean;
  onChange: (provider: ProviderId, model: string) => void;
}) {
  const selected = agent.providers.find((p) => p.id === providerId);

  return (
    <div className="sub-panel">
      <div className="sub-head">Model</div>

      <div className="providers">
        {agent.providers.map((p) => (
          <div key={p.id}>
            <button
              type="button"
              className="menu-item"
              disabled={disabled || !p.available}
              aria-current={p.id === providerId}
              onClick={() => onChange(p.id, p.models[0]?.id ?? "")}
            >
              <span className="menu-text ellipsis">{p.label}</span>
              {p.id === providerId && <span className="type-tag">active</span>}
            </button>
            {!p.available && <p className="provider-reason">{p.reason}</p>}
          </div>
        ))}
      </div>

      {selected?.available && (
        <div className="field">
          <label htmlFor="chat-model">Model</label>
          {selected.models.length > 0 ? (
            <select
              id="chat-model"
              className="model-select"
              value={modelId}
              disabled={disabled}
              onChange={(e) => onChange(selected.id, e.target.value)}
            >
              {selected.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            // Never a silent empty dropdown. If the catalogue could not be
            // fetched, say so and let the operator type an id — a model
            // released this morning is usable this morning.
            <>
              <input
                id="chat-model"
                value={modelId}
                disabled={disabled}
                placeholder="model id"
                onChange={(e) => onChange(selected.id, e.target.value)}
              />
              {selected.modelsReason && <p className="field-hint">{selected.modelsReason}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
