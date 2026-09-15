"use client";

import { useState } from "react";

import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";

const HALF_HOUR_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 ? "30" : "00";
  return {
    value: `${String(hour).padStart(2, "0")}:${minute}`,
    label: `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`,
  };
});

function isHalfHour(value: string) {
  return HALF_HOUR_TIMES.some((time) => time.value === value);
}

function timeLabel(value: string) {
  const [hour, minute] = value.split(":");
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"}`;
}

/** Keeps the named wall-clock value used by the existing timezone conversion. */
export default function OperatorDateTimeField({
  defaultValue = "",
  label,
  name,
  onChange,
  required = false,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  onChange?: () => void;
  required?: boolean;
}) {
  const [date, setDate] = useState(defaultValue.slice(0, 10));
  const [time, setTime] = useState(defaultValue.slice(11, 16));
  const savedTime = defaultValue.slice(11, 16);
  const keepSavedTime = Boolean(savedTime && !isHalfHour(savedTime) && time === savedTime);

  return (
    <fieldset className="min-w-0">
      <legend className="w-full">
        <span className={OPERATOR_LABEL_TEXT_CLASS}>{label}</span>
      </legend>
      <div className="grid min-w-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
        <input
          aria-label={`${label} date`}
          className={`${OPERATOR_FIELD_CLASS} min-w-0 px-2`}
          onChange={(event) => {
            setDate(event.target.value);
            // Never silently round a saved meeting. Changing its date requires
            // selecting an available time if the old time was off the grid.
            if (time && !isHalfHour(time)) setTime("");
            onChange?.();
          }}
          required={required || Boolean(time)}
          type="date"
          value={date}
        />
        <select
          aria-label={`${label} time`}
          className={`${OPERATOR_FIELD_CLASS} min-w-0 px-2`}
          onChange={(event) => { setTime(event.target.value); onChange?.(); }}
          required={required || Boolean(date)}
          value={time}
        >
          <option value="">Choose time</option>
          {keepSavedTime ? <option disabled value={savedTime}>{timeLabel(savedTime)} (saved)</option> : null}
          {HALF_HOUR_TIMES.map((slot) => <option key={slot.value} value={slot.value}>{slot.label}</option>)}
        </select>
      </div>
      <input name={name} type="hidden" value={date && time ? `${date}T${time}` : ""} />
      {!required && (date || time) ? (
        <button
          aria-label={`Clear ${label.toLowerCase()}`}
          className="inline-flex min-h-11 items-center text-xs font-semibold text-black/60 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          onClick={() => { setDate(""); setTime(""); onChange?.(); }}
          type="button"
        >Clear</button>
      ) : null}
    </fieldset>
  );
}
