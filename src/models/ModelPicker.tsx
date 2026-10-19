import { useState } from "react";
import { MAX_MODELS } from "../../modules/models/providers";
import s from "./ModelConnections.module.css";

/** The service's model list: filter, tick, and add the ticked ones. */
export function ModelPicker({
  available,
  added,
  onAdd,
  onClose,
}: {
  available: readonly string[];
  added: readonly string[];
  onAdd: (models: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const room = MAX_MODELS - added.length;
  const shown = available.filter((model) =>
    model.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const toggle = (model: string) =>
    setPicked((value) =>
      value.includes(model)
        ? value.filter((item) => item !== model)
        : [...value, model],
    );
  return (
    <div className={s.picker} role="group" aria-label="服务提供的模型">
      <div className={s.pickerHeader}>
        <span>
          找到 {available.length} 个模型
          {room < available.length && `，还能添加 ${Math.max(room, 0)} 个`}
        </span>
      </div>
      {available.length > 8 && (
        <input
          className={s.filter}
          type="search"
          aria-label="筛选模型"
          placeholder="筛选模型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <ul className={s.options}>
        {shown.map((model) => {
          const exists = added.includes(model);
          const checked = exists || picked.includes(model);
          return (
            <li key={model}>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={exists || (!checked && picked.length >= room)}
                  onChange={() => toggle(model)}
                />
                <span>{model}</span>
                {exists && <span className={s.hint}>已添加</span>}
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className={s.hint}>没有匹配的模型。</li>}
      </ul>
      <div className={s.footerInline}>
        <button type="button" className="secondary" onClick={onClose}>
          收起
        </button>
        <button
          type="button"
          disabled={picked.length === 0}
          onClick={() => onAdd(available.filter((m) => picked.includes(m)))}
        >
          添加所选（{picked.length}）
        </button>
      </div>
    </div>
  );
}
