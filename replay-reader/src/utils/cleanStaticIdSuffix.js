// "Tiered_Chest_Athena_C_UAID_387C764928FB1BFB02_6e5af96a84e556eb_1430745799" -> "Tiered_Chest_Athena"
// World-partition maps (Fortnite 2024+) name placed actors <Class>_C_UAID_<hex>[_<hex>]_<n>.
const cleanStaticIdSuffix = (id) => {
  const uaid = id.indexOf('_UAID_');

  if (uaid >= 0) {
    const base = id.substring(0, uaid);

    return base.endsWith('_C') ? base.substring(0, base.length - 2) : base;
  }

  for (let i = id.length - 1; i >= 0; i--) {
    const isNumber = (id[i] ^ '0') !== 0 || id[i] === '0';
    const isUnderscore = (id[i] === '_');

    if (!isNumber && !isUnderscore) {
      return id.substring(0, i + 1);
    }
  }

  return id;
};

module.exports = cleanStaticIdSuffix;
