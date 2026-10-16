"use client";
import { useState, type KeyboardEvent } from "react";
import { KIND_LABEL, type MemberInput, type TasteKind } from "@/lib/types";
import { Avatar, Icon, colorFor } from "./ui";

const KINDS: TasteKind[] = ["artist", "movie", "place", "book"];
const PLACEHOLDER: Record<TasteKind, string> = {
  artist: "e.g. Radiohead",
  movie: "e.g. Spirited Away",
  place: "e.g. ramen, a favourite bistro",
  book: "e.g. Norwegian Wood",
};

function ChipInput({ values, onChange, placeholder, label }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase()) && values.length < 5) onChange([...values, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
  };
  return (
    <div className="chips">
      {values.map((v) => (
        <span className="chip" key={v}>
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <span aria-hidden>×</span>
          </button>
        </span>
      ))}
      {values.length < 5 && (
        <input
          aria-label={label}
          value={draft}
          placeholder={values.length ? "Add another…" : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
        />
      )}
    </div>
  );
}

export function GroupBuilder({ members, onChange }: { members: MemberInput[]; onChange: (m: MemberInput[]) => void }) {
  const update = (i: number, patch: Partial<MemberInput>) => onChange(members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <div className="members">
      {members.map((m, i) => {
        const count = Object.values(m.tastes).reduce((n, l) => n + l.length, 0);
        return (
          <div className="member" key={i} style={{ ["--m" as string]: colorFor(i) }}>
            <div className="member-head">
              <span className="member-n mono">{String(i + 1).padStart(2, "0")}</span>
              <Avatar name={m.name || `Friend ${i + 1}`} i={i} />
              <input
                className="member-name"
                value={m.name}
                placeholder={`Friend ${i + 1}`}
                aria-label={`Name of friend ${i + 1}`}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <span className={`member-count mono ${count ? "on" : ""}`}>{count ? `${count} picks` : "empty"}</span>
              {members.length > 2 && (
                <button
                  type="button"
                  className="remove"
                  aria-label={`Remove ${m.name || "member"}`}
                  onClick={() => onChange(members.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
            {KINDS.map((k) => {
              const I = Icon[k];
              return (
                <div className="kind" key={k}>
                  <div className="kind-label mono">
                    <I /> {KIND_LABEL[k]}
                  </div>
                  <ChipInput
                    label={`${m.name || `Friend ${i + 1}`} — ${KIND_LABEL[k]}`}
                    values={m.tastes[k]}
                    placeholder={PLACEHOLDER[k]}
                    onChange={(v) => update(i, { tastes: { ...m.tastes, [k]: v } })}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
      {members.length < 8 && (
        <button
          type="button"
          className="add-member"
          onClick={() => onChange([...members, { name: "", tastes: { artist: [], movie: [], place: [], book: [] } }])}
        >
          <span className="plus" aria-hidden>+</span>
          <span>Add a friend</span>
          <span className="mono">{members.length}/8</span>
        </button>
      )}
    </div>
  );
}
