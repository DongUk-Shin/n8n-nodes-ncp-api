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
				displayOptions: {
					show: {
						operation: [
							'credentials',
						],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Credentials 사용',
						value: 'credentials',
						action: 'Credentials',
					},
					{
						name: '직접 입력',
						value: 'manual',
						action: '직접 입력',
					},
				],
				default: 'credentials',
			},
			{
				displayName: 'Access Key',
				name: 'accessKey',
				type: 'string',
				displayOptions: {
					show: {
						operation: [
							'manual',
						],
					},
				},
				default: '',
			},
			{
				displayName: 'Secret Key',
				name: 'secretKey',
				type: 'string',
				typeOptions: {
					password: true,
				},
				displayOptions: {
					show: {
						operation: [
							'manual',
						],
					},
				},
				default: '',
			},
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
					{
						name: 'POST',
						value: 'POST',
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
				displayOptions: {
					show: {
						method: ['GET'],
					},
				},
				default: '{\n  "responseFormatType": "json"\n}',
			},
			{
				displayName: '헤더',
				name: 'headerParameters',
				type: 'json',
				displayOptions: {
					show: {
						method: ['POST'],
					},
				},
				typeOptions: {
					rows: 10,
				},
				default: '{\n  "Content-type": "application/json"\n}',
				description: 'Timestamp, access-key, signature 를 제외한 헤더를 입력해주세요',
			},
			{
				displayName: '바디',
				name: 'bodyParameters',
				type: 'json',
				displayOptions: {
					show: {
						method: ['POST'],
					},
				},
				typeOptions: {
					rows: 10,
				},
				default: '{\n  "test": "1234"\n}',
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
				const apiUrl = this.getNodeParameter('apiUrl', itemIndex, 'https://ncloud.apigw.ntruss.com') as string;
				const uri = this.getNodeParameter('uri', itemIndex, '') as string;
				const method = this.getNodeParameter('method', itemIndex, 'GET') as string;
				const operation = this.getNodeParameter('operation', itemIndex, 'credentials') as string;
				let accessKey = '';
				let secretKey = '';

				if (operation === 'credentials') {
					const credentials = await this.getCredentials('ncpApi');
					accessKey = credentials.accessKey as string;
					secretKey = credentials.secretKey as string;
				} else {
					accessKey = this.getNodeParameter('accessKey', itemIndex, '') as string;
					secretKey = this.getNodeParameter('secretKey', itemIndex, '') as string;
				}
				const queryParameters = this.getNodeParameter('queryParameters', itemIndex, {}) as string | object;

				let params = queryParameters;
				if (typeof queryParameters === 'string') {
					try {
						params = JSON.parse(queryParameters);
					} catch {
						throw new NodeOperationError(this.getNode(), 'Query Parameters must be a valid JSON string', {
							itemIndex,
						});
					}
				}

				let body = {};
				let customHeaders = {};

				if (method === 'POST') {
					const bodyParameters = this.getNodeParameter('bodyParameters', itemIndex, {}) as string | object;
					body = bodyParameters;
					if (typeof bodyParameters === 'string') {
						if (bodyParameters === '') {
							body = {};
						} else {
							try {
								body = JSON.parse(bodyParameters);
							} catch {
								throw new NodeOperationError(this.getNode(), 'Body Parameters must be a valid JSON string', {
									itemIndex,
								});
							}
						}
					}

					const headerParameters = this.getNodeParameter('headerParameters', itemIndex, {}) as string | object;
					customHeaders = headerParameters;
					if (typeof headerParameters === 'string') {
						try {
							customHeaders = JSON.parse(headerParameters);
						} catch {
							throw new NodeOperationError(this.getNode(), 'Header Parameters must be a valid JSON string', {
								itemIndex,
							});
						}
					}
				}

				const fullUrl = `${apiUrl}${uri}`;

				// -----------------------------------------
				// ⭐ 핵심: signature에 들어갈 URI 구성
				// -----------------------------------------
				let signatureUri = uri;

				if (params && Object.keys(params).length > 0) {
					// GET/POST 공통: query string이 있으면 signature에 포함해야 함
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
						...(customHeaders as object),
					},
					qs: params as Record<string, string>,
				};

				if (method === 'POST') {
					options.body = body;
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