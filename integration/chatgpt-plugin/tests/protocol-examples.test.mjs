import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ProtocolValidationError,
  validateProtocolRequest,
} from "../../../dist/protocol/index.js";

function localLookupRequest(payload = {
  url: "https://arxiv.org/abs/2401.01234v2",
  limit: 25,
}) {
  return {
    protocolVersion: 1,
    operationId: "test.find-local.projected-source",
    operation: "find_local_arxiv",
    profileId: "profile-A",
    payload,
  };
}

test("find_local_arxiv accepts the bounded offline lookup and forbids mutation authority", () => {
  const request = localLookupRequest();
  assert.deepEqual(validateProtocolRequest(request), request);

  assert.throws(
    () => validateProtocolRequest({
      ...request,
      authorization: {
        kind: "explicit_request",
        scope: "이미 로컬에 저장된 이 논문을 함께 공부해 줘.",
      },
    }),
    (error) =>
      error instanceof ProtocolValidationError &&
      error.code === "invalid_request" &&
      /only valid for mutations/u.test(error.message),
  );
});

test("find_local_arxiv keeps URL input strict and never accepts a download instruction", () => {
  assert.throws(
    () => validateProtocolRequest(localLookupRequest({
      url: "https://arxiv.org/abs/2401.01234v2",
      limit: 25,
      download: true,
    })),
    (error) =>
      error instanceof ProtocolValidationError &&
      error.code === "invalid_request" &&
      error.message === "$.payload.download is not supported",
  );
});
