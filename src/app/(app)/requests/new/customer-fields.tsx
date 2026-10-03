"use client";

import { useEffect, useRef, useState } from "react";
import { Field, btnCls, inputCls } from "@/components/ui";

export type CustomerValue = {
  id?: string;
  code?: string;
  name: string;
  phone: string;
  email: string | null;
  address: string;
  district: string | null;
  area: string | null;
};

type Option = Required<Pick<CustomerValue, "id" | "code">> & CustomerValue;

const EMPTY: CustomerValue = { name: "", phone: "", email: "", address: "", district: "", area: "" };

/** Customer section with a lookup that autofills the fields from an existing customer. */
export function CustomerFields({ initial }: { initial?: CustomerValue }) {
  const [value, setValue] = useState<CustomerValue>(initial ?? EMPTY);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          setOptions(await res.json());
          setActive(0);
          setOpen(true);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  // Close the list when clicking elsewhere.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(o: Option) {
    setValue(o);
    setQuery("");
    setOptions([]);
    setOpen(false);
  }

  // Results only apply while the query is long enough.
  const shown = query.trim().length >= 2 ? options : [];

  const set = (k: keyof CustomerValue) => (e: React.ChangeEvent<HTMLInputElement>) => setValue({ ...value, [k]: e.target.value });

  return (
    <div className="space-y-3">
      <div ref={boxRef} className="relative">
        <Field label="Find existing customer" hint="Type a name, phone number or customer code (e.g. C-00012)">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => shown.length > 0 && setOpen(true)}
            onKeyDown={(e) => {
              if (!open || !shown.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(shown[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search customers…"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls="customer-options"
            className={inputCls}
          />
        </Field>
        {loading && <span className="absolute right-3 top-8 text-xs text-gray-400">Searching…</span>}
        {open && query.trim().length >= 2 && (
          <ul id="customer-options" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {shown.length === 0 && !loading && <li className="px-3 py-2 text-sm text-gray-500">No customer found – fill in the details below to add a new one.</li>}
            {shown.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-blue-50" : ""}`}
              >
                <div className="font-medium text-gray-900">
                  {o.name} <span className="font-normal text-gray-500">· {o.code}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {o.phone} · {[o.address, o.area, o.district].filter(Boolean).join(", ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {value.id ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span>
            Existing customer <b>{value.code}</b> selected. Editing a field below updates their saved details.
          </span>
          <button type="button" className={btnCls} onClick={() => setValue(EMPTY)}>
            Clear / new customer
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">New customer: fill in the details. If the phone number already exists, that customer is reused.</p>
      )}

      <input type="hidden" name="customerId" value={value.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *">
          <input name="name" required value={value.name} onChange={set("name")} className={inputCls} />
        </Field>
        <Field label="Phone *">
          <input name="phone" required inputMode="tel" value={value.phone} onChange={set("phone")} className={inputCls} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" value={value.email ?? ""} onChange={set("email")} className={inputCls} />
        </Field>
        <Field label="District">
          <input name="district" value={value.district ?? ""} onChange={set("district")} className={inputCls} />
        </Field>
        <Field label="Delivery address *" className="sm:col-span-2">
          <input name="address" required value={value.address} onChange={set("address")} className={inputCls} />
        </Field>
        <Field label="Area">
          <input name="area" value={value.area ?? ""} onChange={set("area")} className={inputCls} />
        </Field>
      </div>
    </div>
  );
}
