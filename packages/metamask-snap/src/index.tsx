import type { OnRpcRequestHandler } from "@metamask/snaps-sdk";
import { Box, Heading, Text } from "@metamask/snaps-sdk/jsx";
import { createSnapController } from "./broker.js";

const handle = createSnapController({
  readState: () =>
    snap.request({ method: "snap_manageState", params: { operation: "get" } }),
  writeState: async (state) => {
    await snap.request({
      method: "snap_manageState",
      params: {
        operation: "update",
        newState: JSON.parse(JSON.stringify(state)),
      },
    });
  },
  now: () => Date.now(),
  confirm: async ({ title, lines }) =>
    (await snap.request({
      method: "snap_dialog",
      params: {
        type: "confirmation",
        content: (
          <Box>
            <Heading>{title}</Heading>
            {lines.map((line) => (
              <Text>{line}</Text>
            ))}
          </Box>
        ),
      },
    })) === true,
});

export const onRpcRequest: OnRpcRequestHandler = async ({
  origin,
  request,
}) => {
  return (await handle(
    origin,
    request,
  )) as ReturnType<OnRpcRequestHandler> extends Promise<infer T> ? T : never;
};
