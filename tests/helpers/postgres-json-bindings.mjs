import postgres from "postgres";

// Constructing the client does not connect. Use the installed production driver's
// JSON parameter and serializer so PGlite cannot hide double serialization.
const driver = postgres({ max: 1, prepare: false });
const JsonParameter = driver.json({}).constructor;
export const json = driver.json;

export function serializeJsonBindings(strings, params) {
  return params.map((param, index) => {
    if (param === null) return null;
    if (param instanceof JsonParameter && param.type === 3802) {
      return param.value === null ? null : driver.options.serializers[3802](param.value);
    }
    // postgres.js discovers JSON types from explicit casts and serializes even
    // plain string arguments; pre-stringified JSON therefore becomes a scalar.
    if (/^\s*::jsonb?\b/i.test(strings[index + 1])) {
      return driver.options.serializers[3802](param);
    }
    return param;
  });
}
