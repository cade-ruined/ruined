"use client";

import { useState } from "react";
import type { FoundationReflection } from "@/data/foundations";
import styles from "./foundations.module.css";

type ReflectionPromptProps = {
  reflection: FoundationReflection;
  values: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
  onAction?: () => void;
  actionComplete?: boolean;
};

export default function ReflectionPrompt({
  reflection,
  values,
  onChange,
  onAction,
  actionComplete = false,
}: ReflectionPromptProps) {
  const [chosenStoryFocused, setChosenStoryFocused] = useState(false);
  const isRewrite = reflection.kind === "rewrite";

  return (
    <div className={styles.reflectionSheet}>
      <div className={styles.paperRegistration} aria-hidden>
        <span>RF / {reflection.id.toUpperCase()}</span>
        <span>PRIVATE · NOT SAVED</span>
      </div>

      <p className={styles.eyebrow}>Reflection</p>
      <h2 className={styles.reflectionPrompt}>{reflection.prompt}</h2>

      <div
        className={`${styles.reflectionFields} ${
          isRewrite ? styles.reflectionFieldsSplit : ""
        }`}
      >
        {reflection.fields.map((field, index) => {
          const struck = isRewrite && index === 0 && chosenStoryFocused;
          return (
            <label
              key={field.id}
              className={`${styles.reflectionField} ${
                struck ? styles.reflectionFieldStruck : ""
              }`}
            >
              <span>{field.label}</span>
              <textarea
                value={values[field.id] ?? field.placeholder}
                onChange={(event) => onChange(field.id, event.target.value)}
                onFocus={() => {
                  if (isRewrite && index === 1) setChosenStoryFocused(true);
                }}
                rows={isRewrite ? 5 : 6}
                spellCheck
              />
              {struck && <i aria-hidden className={styles.fieldStrike} />}
            </label>
          );
        })}
      </div>

      <div className={styles.reflectionFooter}>
        <p>{reflection.interactionNote}</p>
        {reflection.actionLabel && onAction ? (
          <button
            type="button"
            className={styles.cutButton}
            onClick={onAction}
            aria-pressed={actionComplete || undefined}
          >
            <span>{actionComplete ? "Set" : reflection.actionLabel}</span>
            <span aria-hidden>↗</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
