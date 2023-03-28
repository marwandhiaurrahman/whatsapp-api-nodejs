module.exports = {
  apps: [{
    name: "wa-api",
    script: "./multi.js",
    max_memory_restart: '1000M',
    stop_exit_codes: [0],
    instances: 1,
  }]
}
