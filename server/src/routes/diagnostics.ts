import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAllowedEmail, requireAuth } from '../middleware/auth.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { getAccessToken } from '../vertex/client.js';
import { IMAGE_MODEL_IDS, VEO_MODEL_IDS } from '../vertex/models.js';

export const diagnosticsRouter: Router = Router();

// Unauthenticated on purpose: this is what a load balancer or container
// orchestrator polls, and it reveals nothing beyond liveness.
diagnosticsRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

diagnosticsRouter.post(
  '/testVertexConnection',
  requireAuth(),
  requireAllowedEmail(),
  asyncHandler(async (_req, res) => {
    const { projectId, location } = getRuntimeConfig();

    // Minting a token is the cheapest call that proves the service account is
    // both parseable and accepted by Google, which is what operators ask here.
    let tokenOk = false;
    let message = `Vertex AI настроен: проект ${projectId}, регион ${location}.`;
    try {
      await getAccessToken();
      tokenOk = true;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    res.json({
      result: {
        status: tokenOk ? 'ok' : 'error',
        projectId,
        location,
        tokenOk,
        videoModels: VEO_MODEL_IDS,
        imageModels: IMAGE_MODEL_IDS,
        message,
      },
    });
  }),
);
