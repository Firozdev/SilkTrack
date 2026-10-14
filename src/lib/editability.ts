/**
 * When a customer may still change or cancel what they submitted in the
 * portal: before staff start working on it.
 */
export function portalRequestEditable(o: { requestStatus: string; estimateCount: number }) {
  return o.requestStatus === "NEW" && o.estimateCount === 0;
}

export function portalShippingEditable(s: { status: string }) {
  return s.status === "REQUESTED";
}
