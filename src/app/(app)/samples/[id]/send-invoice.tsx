"use client";

import { useState, useTransition } from "react";
import { btnCls } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { invoiceSentAction } from "../actions";

/**
 * Opens WhatsApp / email with the invoice message ready to send and logs it on
 * the sample. (No SMS/WhatsApp gateway yet – the message is sent from the
 * user's own WhatsApp/email; attach the saved PDF there.) `action` logs it
 * on another record type (e.g. a shipping order); defaults to the sample.
 */
export function SendInvoice({
  sampleId,
  whatsappUrl,
  mailtoUrl,
  action = invoiceSentAction,
}: {
  sampleId: string;
  whatsappUrl: string;
  mailtoUrl: string | null;
  action?: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState("");

  function send(channel: "WHATSAPP" | "EMAIL", url: string) {
    window.open(url, "_blank", "noopener");
    start(async () => {
      const fd = new FormData();
      fd.set("id", sampleId);
      fd.set("channel", channel);
      const res = await action({}, fd);
      setDone(res.error ?? `Logged as sent by ${channel === "WHATSAPP" ? "WhatsApp" : "email"}.`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={pending} className={btnCls} onClick={() => send("WHATSAPP", whatsappUrl)}>
        💬 Send by WhatsApp
      </button>
      {mailtoUrl && (
        <button type="button" disabled={pending} className={btnCls} onClick={() => send("EMAIL", mailtoUrl)}>
          ✉ Send by email
        </button>
      )}
      {done && <span className="text-sm text-green-700">{done}</span>}
    </div>
  );
}
