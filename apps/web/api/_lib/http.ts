export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  query: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  json: (payload: unknown) => void;
  send: (payload: unknown) => void;
}
