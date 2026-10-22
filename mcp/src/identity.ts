import type { ConfiguredUser } from "./config";
import { normalizePhone } from "./utils/phone";

type TrustedSender = {
  platform: "bluebubbles";
  chatType: "dm";
  senderId: string;
};

export function resolveTrustedSender(users: ConfiguredUser[], value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trusted iMessage sender metadata is required");
  }

  const { platform, chatType, senderId } = value as Partial<TrustedSender>;
  if (platform !== "bluebubbles" || chatType !== "dm" || typeof senderId !== "string") {
    throw new Error("A trusted direct iMessage sender is required");
  }

  let phone: string;
  try {
    phone = normalizePhone(senderId);
  } catch {
    throw new Error("Unrecognized iMessage sender");
  }
  const user = users.find(candidate => candidate.phone === phone);
  if (!user) throw new Error("Unrecognized iMessage sender");
  return user;
}
