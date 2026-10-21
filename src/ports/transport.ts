import type { ProtocolResponse, TransportDescription } from "../protocol/types.js";

export interface ProtocolTransportMessage {
  body: Uint8Array;
}

export type ProtocolTransportHandler = (
  message: ProtocolTransportMessage,
) => Promise<ProtocolResponse>;

export interface ProtocolTransportSubscription {
  close(): Promise<void>;
}

/** Byte transport only; parsing and validation stay at the protocol boundary. */
export interface ProtocolTransportPort {
  describe(): TransportDescription;
  listen(handler: ProtocolTransportHandler): Promise<ProtocolTransportSubscription>;
}
