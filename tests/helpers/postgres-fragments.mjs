const fragment = Symbol("postgres test query fragment");

/** Match postgres.js lazy query composition without turning nested SQL into a parameter. */
export function taggedSqlBridge(execute) {
  return (parts, ...values) => {
    let result;
    return {
      [fragment]: { parts, values },
      then(onFulfilled, onRejected) {
        result ??= Promise.resolve().then(() => {
          const strings = [""];
          const params = [];
          const append = (queryParts, queryValues) => {
            strings[strings.length - 1] += queryParts[0];
            queryValues.forEach((value, index) => {
              if (value?.[fragment]) append(value[fragment].parts, value[fragment].values);
              else {
                params.push(value);
                strings.push("");
              }
              strings[strings.length - 1] += queryParts[index + 1];
            });
          };
          append(parts, values);
          const text = strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, "");
          return execute(text, params, strings);
        });
        return result.then(onFulfilled, onRejected);
      },
    };
  };
}
