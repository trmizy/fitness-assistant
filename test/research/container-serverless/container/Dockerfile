# Same OS (Amazon Linux 2023) and Node 22 build as the nodejs22.x Lambda
# runtime; the artifact only ships the rhel-openssl-3.0.x Prisma engine.
FROM public.ecr.aws/lambda/nodejs:22
# ./artifact = unzipped fitness-assistant-dev-fitness deployment package
COPY artifact/ /var/task/
COPY entry.js /var/task/entry.js
ENV PORT=3002 FITNESS_DISABLE_REDIS=true
EXPOSE 3002
ENTRYPOINT ["/var/lang/bin/node", "/var/task/entry.js"]
