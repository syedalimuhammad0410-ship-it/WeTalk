process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://webscout:webscout@localhost:5432/webscout_test";
process.env.APP_ENCRYPTION_KEY = "test-encryption-key-0123456789abcdef-0123";
process.env.AUDIT_ALLOW_PRIVATE_HOSTS = "true";
process.env.ENABLE_EMAIL_SANDBOX = "true";
process.env.JOB_RUNNER = "external";
process.env.ANTHROPIC_API_KEY = "";
process.env.GOOGLE_MAPS_API_KEY = "";
