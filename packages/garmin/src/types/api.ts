export interface ApiOptions {
    method?: string;
    params?: Record<string, string | number | undefined>;
    json?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
}

export interface ApiClient {
    connectapi<T = unknown>(
        path: string,
        options?: ApiOptions,
    ): Promise<T | null>;
}

export interface ApiUploadClient extends ApiClient {
    upload(
        file: Blob,
        filename: string,
        path?: string,
        options?: Pick<ApiOptions, "timeoutMs" | "headers">,
    ): Promise<unknown>;
}

export interface ApiTransferClient extends ApiUploadClient {
    download(path: string, options?: ApiOptions): Promise<Uint8Array>;
}
