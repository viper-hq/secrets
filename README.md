# AWS related secret management helpers

## Usage

### SSM

#### batchGet

```typescript
const ssm = new SSM({
  region: "us-east-1"
});
const params = [
  {
    name: "/production/service/secrets.json"
    default: JSON.stringify({
      password: process.env.PASSWORD
    })
  },
  {
    name: "/production/service/private.pem",
    target: path.join(rootDir, "certs", "private.pem")
  }
];
const result = await ssm.batchGet(params);
console.log(result);
/*
{
  "/production/service/secrets.json": "{\"password\":\"123\"}",
  "/production/service/private.pem": "PEM_FILE_CONTENTS"
}
*/
```
