export const handler = async (event = {}) => {
  console.log(JSON.stringify({
    level: "info",
    service: "fitness-assistant",
    environment: "dev",
    routeKey: event.routeKey,
    requestId: event.requestContext?.requestId,
    message: "hello invoked",
  }));

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      status: "ok",
      service: "fitness-assistant",
      environment: "dev",
    }),
  };
};
