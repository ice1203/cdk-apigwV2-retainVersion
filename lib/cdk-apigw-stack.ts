import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cforigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

export interface ApigwStageProps {
    stageName: string;
    stageVariables: { [key: string]: any };
}
export class CdkApigwStack extends cdk.Stack {
    private stagev1: ApigwStageProps = {
        stageName: "v1",
        stageVariables: {
            ["lambdaVersion"]: "1",
        },
    };
    // 使用するgithubリポジトリに応じて以下書き換え
    private gitHubOwner: string = "ice1203";
    private repositoryName: string = "cdk-apigwV2-retainVersion";

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // IAM Role for githubActions
        // IAM OIDC Providerがない場合は以下のコメントを外して作成
        /*const oidcprovider = new iam.OpenIdConnectProvider(this, "OIDCProvider", {
      url: "https://token.actions.githubusercontent.com",
      thumbprints: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
      clientIds: ["sts.amazonaws.com"],
    });*/
        // IAM Role
        const roleForGithubAction = new iam.Role(this, "RoleForGithubAction", {
            roleName: "my-githubactions-role",
            assumedBy: new iam.WebIdentityPrincipal(
                `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
                {
                    StringEquals: {
                        ["token.actions.githubusercontent.com:aud"]:
                            "sts.amazonaws.com",
                    },
                    StringLike: {
                        ["token.actions.githubusercontent.com:sub"]: `repo:${this.gitHubOwner}/${this.repositoryName}:*`,
                    },
                }
            ),
        });
        // 検証目的のためAdmin権限、実際の運用では最小権限を推奨
        roleForGithubAction.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")
        );
        // Lambda function
        const myLambda = new lambda.Function(this, "MyLambda", {
            runtime: lambda.Runtime.PYTHON_3_9,
            handler: "index.handler",
            code: lambda.Code.fromAsset("lambda_src"),
            currentVersionOptions: {
                removalPolicy: cdk.RemovalPolicy.RETAIN,
            },
        });
        // Lambdaにバージョン発行させるためにcurrentVersionプロパティを使用する必要がある
        myLambda.currentVersion;

        // create an HTTP API
        const httpApi = new apigw.CfnApi(this, "HttpApi", {
            name: "HttpApi",
            protocolType: "HTTP",
        });

        // add routes and integrations
        const apigwRole = new iam.Role(this, "apigwRole", {
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            inlinePolicies: {
                ["InvokeFunction"]: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            actions: ["lambda:InvokeFunction"],
                            effect: iam.Effect.ALLOW,
                            resources: [`${myLambda.functionArn}:*`],
                        }),
                    ],
                }),
            },
        });
        const usersIntegration = new apigw.CfnIntegration(
            this,
            "usersIntegration",
            {
                apiId: httpApi.ref,
                integrationType: "AWS_PROXY",
                integrationUri:
                    myLambda.functionArn + ":${stageVariables.lambdaVersion}",
                payloadFormatVersion: "2.0",
                credentialsArn: apigwRole.roleArn,
            }
        );

        const usersRoute = new apigw.CfnRoute(this, "usersRoute", {
            apiId: httpApi.ref,
            routeKey: "GET /users",
            target: `integrations/${usersIntegration.ref}`,
        });

        // add stage
        const apigwStageV1 = new apigw.CfnStage(this, "apigwStageV1", {
            apiId: httpApi.ref,
            stageName: this.stagev1.stageName,
            autoDeploy: true,
            stageVariables: this.stagev1.stageVariables,
        });

        // CloudFront distribution
        const myDistribution = new cloudfront.Distribution(
            this,
            "MyDistribution",
            {
                defaultRootObject: "index.html",
                defaultBehavior: {
                    origin: new cforigins.HttpOrigin(
                        `${httpApi.attrApiId}.execute-api.${this.region}.${this.urlSuffix}`
                    ),
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    // AllViewerExceptHostHeaderのポリシーを設定
                    // HostヘッダをOriginにわたすとそのHost名の証明書を要求しようとするので「SignatureDoesNotMatch」となるため
                    originRequestPolicy:
                        cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(
                            this,
                            "orpExceptHost",
                            "b689b0a8-53d0-40ab-baf2-68738e2966ac"
                        ),
                    viewerProtocolPolicy:
                        cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                },
            }
        );

        // Output
        new cdk.CfnOutput(this, "ApiUrl", {
            value:
                httpApi.attrApiEndpoint ??
                "Something went wrong with the deploy",
        });
        new cdk.CfnOutput(this, "roleForGithubActionArn", {
            value: roleForGithubAction.roleArn,
        });
    }
}
