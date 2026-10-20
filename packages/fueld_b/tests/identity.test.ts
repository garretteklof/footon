import { expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { resolveTrustedSender } from "../src/identity";

const users = parseConfig({ users: {
  garrett: { name: "Garrett", phone: "+16085550100", timezone: "America/Chicago" },
  emily: { name: "Emily", phone: "+16085550101", timezone: "America/Chicago" },
} }).users;

test("resolves only known direct BlueBubbles senders", () => {
  expect(resolveTrustedSender(users, {
    platform: "bluebubbles", chatType: "dm", senderId: "(608) 555-0100",
  }).id).toBe("garrett");
  for (const value of [
    undefined,
    { platform: "other", chatType: "dm", senderId: "+16085550100" },
    { platform: "bluebubbles", chatType: "group", senderId: "+16085550100" },
    { platform: "bluebubbles", chatType: "dm", senderId: "+16085550999" },
    { platform: "bluebubbles", chatType: "dm", senderId: "not a phone" },
  ]) {
    expect(() => resolveTrustedSender(users, value)).toThrow();
  }
});
