import AWS from "aws-sdk";
import https from "https";
import path from "path";
import { promises as fs, fsync } from "fs";

export interface SSMOptions {
  /**
   * Region to query
   */
  region?: string;
  /**
   * External client
   */
  client?: AWS.SSM
  /**
   * Error reporting on file system or connection errors
   * By default, it falls back to the default value
   */
  onError?: (err: Error) => any;
}

export interface SSMParameterPut extends SSMParameter {
  content: string;
  encrypted?: boolean;
  description?: string;
  keyId?: string;
  overwrite?: boolean;
}

export interface SSMParameter {
  /**
   * Name (or path) of the parameter
   */
  name: string;
  /**
   * Absolute path to save as file if needed
   */
  target?: string;
  /**
   * It throws error if no default value and could not get the parameter
   */
  default?: string;
}

/**
 * Contains parameter, utf8 text pairs
 */
export type SSMParameterMap<T = string> = {
  [name: string]: T;
};

/**
 * Class to communicate with the SSM Paramter store
 */
export class SSM {
  options: SSMOptions;
  client: AWS.SSM;
  constructor(
    options: SSMOptions,
    clientConfiguration: AWS.SSM.ClientConfiguration = {
      region: options.region,
      httpOptions: {
        agent: new https.Agent({
          // Keeping the connection alive helps with consecutive calls
          keepAlive: true
        })
      }
    }
  ) {
    this.options = options;
    if (!this.options.onError) {
      // default error logger is the console.error
      this.options.onError = console.error;
    }
    this.client = this.options.client;
    if (!this.client) {
      this.client = new AWS.SSM(clientConfiguration);
    }
  }
  async put(params: SSMParameterPut): Promise<string> {
    const optValues = {} as Partial<AWS.SSM.PutParameterRequest>;
    if (params.keyId) {
      optValues.KeyId = params.keyId;
    }
    if (params.description) {
      optValues.Description = params.description;
    }
    await this.client
      .putParameter({
        Name: params.name,
        Value: params.content,
        Type: params.encrypted ? "SecureString" : "String",
        Overwrite: params.overwrite,
        ...optValues
      })
      .promise();
    return (await this.batchGet([params]))[params.name];
  }
  async batchDelete(parameters: SSMParameter[]): Promise<string[]> {
    const response = await this.client
      .deleteParameters({
        Names: parameters.map(p => p.name)
      })
      .promise();
    const responseMap = response.DeletedParameters.reduce(
      (memo: SSMParameterMap<boolean>, act) => {
        memo[act] = true;
        return memo;
      },
      {}
    );
    const result = await Promise.all(
      parameters.map(async param => {
        if (!responseMap[param.name]) {
          throw new Error(`${param.name} is not deleted!`);
        }
        if (param.target) {
          await fs.unlink(param.target);
        }
        return param.name;
      })
    );
    return result;
  }
  async batchGet(parameters: SSMParameter[]): Promise<SSMParameterMap> {
    const response = await this.client
      .getParameters({
        Names: parameters.map(param => param.name),
        // it only decrypts if needed
        WithDecryption: true
      })
      .promise()
      .catch(async e => {
        // reporting the error and go with the default values
        await this.options.onError(e);
        return {
          Parameters: []
        };
      });
    const responseMap = response.Parameters.reduce(
      (memo: SSMParameterMap, act) => {
        memo[act.Name] = act.Value;
        return memo;
      },
      {}
    );
    const result = await Promise.all(
      parameters.map(async param => {
        const text: string = responseMap[param.name] || param.default;
        if (!text) {
          // If no default, it will throw an error
          throw new Error(`${param.name} is required!`);
        }
        if (param.target) {
          // mkdir -p
          await fs.mkdir(path.join(param.target, ".."), { recursive: true });
          // on Windows and for hidden directories, this will throw an error
          // replaces the file if exists
          const fh = await fs.open(param.target, "w");
          await fs.writeFile(fh, text, "utf8");
          await new Promise<void>((resolve, reject) =>
            // we are making sure the file is written to the disk if we want to start another process
            // or something is polling or watching
            fsync(fh.fd, err => {
              fh.close()
                .catch(async e => {
                  await this.options.onError(e);
                })
                .then(() => {
                  if (err) {
                    return reject(err);
                  }
                  resolve();
                });
            })
          );
        }
        return [param.name, text];
      })
    );
    return result.reduce((memo: SSMParameterMap, act) => {
      memo[act[0]] = act[1];
      return memo;
    }, {});
  }
}
