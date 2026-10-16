#!/bin/bash
aws apigatewayv2 delete-route --api-id id1iz7upbl --region ap-southeast-1 --route-id 1qn9tii
aws apigatewayv2 delete-route --api-id id1iz7upbl --region ap-southeast-1 --route-id no4a9ym
aws lambda remove-permission --function-name fitness-assistant-dev-fitness --region ap-southeast-1 --statement-id fitness-roadmaps-exact
aws lambda remove-permission --function-name fitness-assistant-dev-fitness --region ap-southeast-1 --statement-id fitness-roadmaps-proxy
