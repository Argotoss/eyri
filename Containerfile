FROM denoland/deno:2.5.4 AS runtime

WORKDIR /app

COPY deno.json deno.lock ./
COPY src ./src

RUN deno cache --allow-import --lock=deno.lock src/main.ts

CMD ["run", "--env-file=.env", "-A", "src/main.ts"]
