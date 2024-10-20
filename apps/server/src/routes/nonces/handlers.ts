import { eq } from "drizzle-orm";
import db from "src/db";
import { nonces } from "src/db/schema";
import { ZOD_ERROR_CODES, ZOD_ERROR_MESSAGES } from "src/lib/constants";
import type { AppRouteHandler } from "src/lib/types";
import * as HttpStatusCodes from "stoker/http-status-codes";
import * as HttpStatusPhrases from "stoker/http-status-phrases";
import type * as routes from "./routes";

import {
  createAdvanceTransaction,
  createNonce,
  executeTransaction,
  getAuthKeypair,
  getKeypair,
} from "./utils";

export const create: AppRouteHandler<typeof routes.create> = async (c) => {
  const data = c.req.valid("json");

  const nonceKeypair = getKeypair();
  const nonceAuthKeypair = getAuthKeypair();
  c.var.logger.info("Creating nonce for: ", nonceKeypair.publicKey.toBase58());

  const nonce = await createNonce({ nonceKeypair, nonceAuthKeypair });
  c.var.logger.info("Nonce: ", nonce);

  const advanceTx = await createAdvanceTransaction({
    ...data,
    nonce,
    nonceKeypair,
    nonceAuthKeypair,
  });

  const [inserted] = await db
    .insert(nonces)
    .values({
      ...data,
      nonce,
      transaction: advanceTx,
    })
    .returning();

  return c.json(inserted, HttpStatusCodes.OK);
};

export const patch: AppRouteHandler<typeof routes.patch> = async (c) => {
  const { id } = c.req.valid("param");
  const { signature } = c.req.valid("json");

  if (!signature) {
    return c.json(
      {
        success: false,
        error: {
          issues: [
            {
              code: ZOD_ERROR_CODES.INVALID_UPDATES,
              path: [],
              message: ZOD_ERROR_MESSAGES.NO_UPDATES,
            },
          ],
          name: "ZodError",
        },
      },
      HttpStatusCodes.UNPROCESSABLE_ENTITY
    );
  }

  // TODO: validate solana serialized transaction
  c.var.logger.info("Updating nonce with signature: ", signature);

  const [nonce] = await db
    .update(nonces)
    .set({ signature })
    .where(eq(nonces.id, id))
    .returning();

  if (!nonce) {
    return c.json(
      {
        message: HttpStatusPhrases.NOT_FOUND,
      },
      HttpStatusCodes.NOT_FOUND
    );
  }

  // NOTE: executed immediately, but can be added to a queue
  await executeTransaction(signature);

  return c.json(nonce, HttpStatusCodes.OK);
};
