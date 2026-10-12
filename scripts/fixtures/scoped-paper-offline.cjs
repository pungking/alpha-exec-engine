const deny = () => { throw Error('OFFLINE_NETWORK_DENIED'); };
globalThis.fetch = deny;
for (const [module, methods] of [['http', ['request', 'get']], ['https', ['request', 'get']],
  ['net', ['connect', 'createConnection']], ['tls', ['connect']]]) {
  for (const method of methods) require(module)[method] = deny;
}
