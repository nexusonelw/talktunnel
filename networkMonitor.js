function sameIps(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function startNetworkMonitor({ getLanIps, getPort, onChange, intervalMs = 5000 }) {
  let lastIps = getLanIps();

  const timer = setInterval(async () => {
    const nextIps = getLanIps();
    if (sameIps(lastIps, nextIps)) return;

    lastIps = nextIps;
    try {
      await onChange({ lanIps: nextIps, port: getPort() });
    } catch (error) {
      console.error('Failed to sync IP change:', error.message);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

module.exports = { startNetworkMonitor };
