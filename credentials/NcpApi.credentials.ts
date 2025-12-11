import type {
	Icon,
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
} from 'n8n-workflow';

export class NcpApi implements ICredentialType {
	name = 'ncpApi';

	displayName = 'NCP API';

	documentationUrl = 'https://github.com/DongUk-Shin/n8n-nodes-ncp-api';

	icon: Icon = { light: 'file:../icons/ncp.svg', dark: 'file:../icons/ncp.dark.svg' };


	properties: INodeProperties[] = [
		{
			displayName: 'Access Key',
			name: 'accessKey',
			type: 'string',
			typeOptions: { password: false },
			default: '',
		},
		{
			displayName: 'Secret Key',
			name: 'secretKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://www.ncloud.com/v2',
			url: '/',
			method: 'GET',
		},
	};
}
