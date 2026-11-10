/**
 * Host half of the live token-throughput bundle.
 *
 * Every observable behavior lives in the browser half (`client.js`): the meter
 * reads Session projections and the live Assistant stream that the Client
 * already folds, so the Host adds no service, event, tool, or prompt text.
 *
 * @returns Nothing; the bundle exists to insert one Client-facing row.
 */
export function apply() {}
