import type {
  ClientTransport,
  TransportRequest,
  TransportResponse,
} from "@workforce/desktop-client";
import type { ApiRequest, ApiResponse } from "@workforce/ui";

export type IpcApiRequestFn = (input: ApiRequest) => Promise<ApiResponse>;

export function createIpcTransport(request: IpcApiRequestFn): ClientTransport {
  return {
    async request(req: TransportRequest): Promise<TransportResponse> {
      const input: ApiRequest = { method: req.method, path: req.path };
      if (req.headers !== undefined) {
        input.headers = req.headers;
      }
      if (req.body !== undefined) {
        input.body = req.body;
      }
      const res = await request(input);
      if (res.ok) {
        return { status: res.status, headers: {}, body: res.body };
      }
      return {
        status: res.status,
        headers: {},
        body: {
          type: `urn:workforce:error:${res.code}`,
          title: res.message,
          status: res.status,
          code: res.code,
          detail: res.message,
          instance: req.path,
          requestId: "",
          retryable: res.status >= 500,
        },
      };
    },
  };
}
