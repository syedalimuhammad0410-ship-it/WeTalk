// Mathly standalone server.
import { app } from './app.ts';
import { config } from './config.ts';
import { aiConfigured } from './ai/provider.ts';
import { APP_NAME } from '../shared/curriculum.ts';

app.listen(config.port, () => {
  console.log(`${APP_NAME} API listening on http://localhost:${config.port}  (AI: ${aiConfigured() ? config.ai.model : 'built-in engine'})`);
});
