import express from 'express';
import { PadiEngine } from '@samuelmuriithi/sovereign-node';

const app = express();
const port = process.env.PORT || 3000;
const engine = new PadiEngine();

async function bootstrap() {
  console.log("\n--- [PADI Sovereign Bureau: API Gateway] ---");
  
  // Start the underlying engine
  await engine.start();

  app.get('/health', (req, res) => {
    res.json({ status: 'Sovereign', node: 'Nairobi-01' });
  });

  app.listen(port, () => {
    console.log(`[API] Server listening at http://localhost:${port}`);
    console.log("-------------------------------------------\n");
  });
}

bootstrap().catch(err => {
  console.error("[API] Critical Startup Failure:", err);
  process.exit(1);
});
