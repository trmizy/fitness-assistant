PGB="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433"
export TZ=Asia/Ho_Chi_Minh NODE_ENV=development
export JWT_SECRET=afr_jwt_secret_32_chars_minimum_value_x
export INTERNAL_SERVICE_SECRET=afr_internal_service_secret_32_chars_min
export INTERNAL_API_SECRET=afr_internal_api_secret_32_chars_minimum
export AUTH_SERVICE_URL=http://localhost:43001 USER_SERVICE_URL=http://localhost:43004 PAYMENT_SERVICE_URL=http://localhost:43007
export GYM_SERVICE_URL=http://localhost:43006 AI_SERVICE_URL=http://localhost:43003 FITNESS_SERVICE_URL=http://localhost:43002 CHAT_SERVICE_URL=http://localhost:43005
export FITNESS_DISABLE_REDIS=true REDIS_HOST=localhost REDIS_PORT=46379
export REQUIRE_CONTRACT_ESIGN=false
export VNPAY_SIMULATE=true VNPAY_HASH_SECRET=afr_vnpay_hash_secret VNPAY_TMN_CODE=AFRTEST1 PAYMENT_PUBLIC_URL=http://localhost:43007 VNPAY_RETURN_URL=http://localhost:43007/payments/vnpay/return FRONTEND_URL=http://localhost:45173
export PAYMENT_PROVIDER=VNPAY
export SMTP_HOST= SMTP_USER= SMTP_PASS=
export LLM_PROVIDER=mock QDRANT_HOST=localhost QDRANT_PORT=46333
export AUTH_RATE_LIMIT_MAX_REQUESTS=100000 RATE_LIMIT_MAX_REQUESTS=1000000 LOGIN_RATE_LIMIT_MAX=100000
