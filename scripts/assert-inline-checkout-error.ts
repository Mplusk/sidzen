import assert from "node:assert/strict";
export async function assertInlineCheckoutError(response: Response, code: string) {
  assert.equal(response.status, 200, "Expected a recoverable action response");
  assert.equal(response.headers.get("location"), null, "An expected checkout error must not navigate away");
  const body = (await response.text()).replace(/\\+"/g, '"').replaceAll("&quot;", '"');
  assert(body.includes(`"error":"${code}"`), `Expected serialized checkout error ${code}`);
}
