import {
    ComponentResource,
    ComponentResourceOptions,
    Output,
    Input
} from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export interface LambdaResourceArgs {

    /**
     * The function directory. Theses files will be used to package the function.
     */
    readonly directory: Input<string>

    /**
     * The function language. Useful to determine how it will be packaged.
     */
    readonly language: Input<"TS" | "JS">,

    /**
     * The function entrypoint in your code.
     * Defaults to `index.handler`
     */
    readonly handler?: Input<string>,

    /**
     * The Lambda environment's configuration settings.
     */
    readonly environment?: Input<aws.types.input.lambda.FunctionEnvironment>

    /**
     * IAM role attached to the Lambda Function. This governs both who / what can invoke your Lambda Function, as well as what resources our Lambda Function has access to.
     */
    readonly role: Input<string>
};

const RUNTIME_TABLE = {
    "TS": "nodejs12.x",
    "JS": "nodejs12.x"
}

export class LambdaResouce extends ComponentResource {

    readonly handler: Output<string>;
    readonly runtime: Output<string>;
    readonly role: Output<string>;
    readonly environment?: Output<aws.types.input.lambda.FunctionEnvironment>;
    readonly fileArchive: Promise<pulumi.asset.FileArchive>;
    readonly function: Output<aws.lambda.Function>;

    /**
     * Component dedicated to create lambdas from non compiled directory
     * @param name Name of the resource
     * @param args Args for the resource
     * @param opts Options for the resource
     */
    constructor(name: string, args: LambdaResourceArgs, opts?: ComponentResourceOptions) {
        super("nebulis:lambda-resource", name, {}, opts);

        if (args.handler !== undefined) {
            this.handler = pulumi.output(args.handler);
        } else {
            this.handler = pulumi.output("index.handler");
        }

        this.runtime = pulumi.output(args.language).apply(language => RUNTIME_TABLE[language]);

        this.role = pulumi.output(args.role);

        if (args.environment !== undefined) {
            this.environment = pulumi.output(args.environment);
        }

        let promise = this.cleanFiles(args.directory.toString());
        promise = promise.then(_ => this.installNodeModules(args.directory.toString()));
        if (args.language == "TS") {
            promise = promise.then(_ => this.compileTypescript(args.directory.toString()));
        }
        promise = promise.then(_ => this.redateFiles(args.directory.toString()));
        promise = promise.then(_ => this.bundleJavascript(args.directory.toString()));

        this.fileArchive = promise.then(_ => new pulumi.asset.FileArchive(`${args.directory}/bundle.zip`))

        this.function = pulumi.output(new aws.lambda.Function(name, {
            handler: this.handler,
            code: this.fileArchive,
            runtime: this.runtime,
            role: this.role,
            environment: this.environment
        }, {
            parent: this
        }))

        this.registerOutputs({
            function: this.function,
            runtime: this.runtime,
            environment: this.environment,
            role: this.role,
            handler: this.handler,
            fileArchive: this.fileArchive
        });
    }

    async installNodeModules(directory: string): Promise<any> {
        return execPromise("yarn --no-lockfile", {
            cwd: directory
        });
    }

    async compileTypescript(directory: string): Promise<any> {
        return execPromise("tsc", {
            cwd: directory
        });
    }

    async bundleJavascript(directory: string): Promise<any> {
        return execPromise("zip bundle.zip -r node_modules *.js", {
            cwd: directory
        });
    }

    async redateFiles(directory: string): Promise<any> {
        return execPromise("find node_modules/ -exec touch -cd @0 {} + && find . -name '*.js' -exec touch -cd @0 {} +", {
            cwd: directory
        });
    }

    async cleanFiles(directory: string): Promise<any> {
        return execPromise("rm -rf *.js node_modules bundle.zip package-lock.json", {
            cwd: directory
        });
    }

}