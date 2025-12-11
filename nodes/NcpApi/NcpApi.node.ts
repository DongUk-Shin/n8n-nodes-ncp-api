import * as crypto from 'crypto';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

// Helper function to create NCP API Signature
function makeSignature(
	method: string,
	url: string,
	timestamp: string,
	accessKey: string,
	secretKey: string,
): string {
	const space = ' ';
	const newLine = '\n';
	const message = method + space + url + newLine + timestamp + newLine + accessKey;
	const hmac = crypto.createHmac('sha256', secretKey);
	const signature = hmac.update(message).digest('base64');
	return signature;
}

export class NcpApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NCP API',
		name: 'ncpApi',
		icon: { light: 'file:ncp.svg', dark: 'file:ncp.dark.svg' },
		group: ['input'],
		version: 1,
		description: 'NCP API 요청을 날리는 노드입니다',
		defaults: {
			name: 'NCP API',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'ncpApi',
				displayName: 'Credential',
			},
		],
		properties: [
			{
				displayName: 'API URL',
				name: 'apiUrl',
				type: 'string',
				default: '',
				placeholder: 'https://ncloud.apigw.ntruss.com',
			},
			{
				displayName: 'URI',
				name: 'uri',
				type: 'string',
				default: '',
				placeholder: '/vserver/v2/getAccessControlGroupList',
			},
			{
				displayName: '메서드',
				name: 'method',
				type: 'options',
				options: [
					{
						name: 'GET',
						value: 'GET',
					},
				],
				default: 'GET',
			},
			{
				displayName: '쿼리 파라미터',
				name: 'queryParameters',
				type: 'json',
				typeOptions: {
					rows: 10,
				},
				default: '{\n  "responseFormatType": "json"\n}',
				description: '요청 쿼리 파라미터',
			},
		],
	};

	// The function below is responsible for actually doing whatever this node
	// is supposed to do.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const baseUrl = this.getNodeParameter('baseUrl', itemIndex, 'https://ncloud.apigw.ntruss.com') as string;
				const uri = this.getNodeParameter('uri', itemIndex, '') as string;
				const method = this.getNodeParameter('method', itemIndex, 'GET') as string;
				const credentials = await this.getCredentials('ncpApi');
				const accessKey = credentials.accessKey as string;
				const secretKey = credentials.secretKey as string;
				const queryParameters = this.getNodeParameter('queryParameters', itemIndex, {}) as string | object;

				let params = queryParameters;
				if (typeof queryParameters === 'string') {
					try {
						params = JSON.parse(queryParameters);
					} catch {
						throw new NodeOperationError(this.getNode(), 'Parameters must be a valid JSON string', {
							itemIndex,
						});
					}
				}
				const fullUrl = `${baseUrl}${uri}`;

				// -----------------------------------------
				// ⭐ 핵심: signature에 들어갈 URI 구성
				// -----------------------------------------
				let signatureUri = uri;

				if (method === 'GET' && params && Object.keys(params).length > 0) {
					// GET은 query string을 signature에 포함해야 함
					const queryString = new URLSearchParams(params as Record<string, string>).toString();
					signatureUri = `${uri}?${queryString}`;
				}

				// -----------------------------------------
				// ⭐ Signature 생성
				// -----------------------------------------
				const timestamp = Date.now().toString();
				const signature = makeSignature(method, signatureUri, timestamp, accessKey, secretKey);

				const options: IHttpRequestOptions = {
					method: method as IHttpRequestMethods,
					url: fullUrl,
					returnFullResponse: false,
					headers: {
						'Content-Type': 'application/json',
						'x-ncp-apigw-timestamp': timestamp,
						'x-ncp-iam-access-key': accessKey,
						'x-ncp-apigw-signature-v2': signature,
					},
				};

				if (method === 'GET') {
					options.qs = params as Record<string, string>;
				}

				const response = await this.helpers.httpRequest(options);

				returnData.push({
					json: response,
					pairedItem: { item: itemIndex },
				});

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), error, { itemIndex });
			}
		}

		return [returnData];
	}
}