# Sharetribe Web Template

[![CircleCI](https://circleci.com/gh/sharetribe/web-template.svg?style=svg)](https://circleci.com/gh/sharetribe/web-template)

This is a template web application for a Sharetribe Flex marketplaces. You could create your own
unique marketplace web app by cloning this repository and then extending and customizing it to your
needs. This template is bootstrapped with
[create-react-app](https://github.com/facebookincubator/create-react-app) with some additions,
namely server side rendering, code-splitting, and a custom CSS setup.

> **Note**: This is a _**beta**_ version, but you should consider starting your customization
> project on top of this instead of old templates:
>
> - [FTW-daily](https://github.com/sharetribe/ftw-daily)
> - [FTW-hourly](https://github.com/sharetribe/ftw-hourly)
> - [FTW-product](https://github.com/sharetribe/ftw-hourly)
>
> Read more from
> [Flex Docs preview version](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/ftw/sharetribe-web-template/)
>
> _Note: The search does not work on the preview version of the Flex Docs. It links to live
> documentation._

## Quick start

### Take the new (beta) processes into use

You need to add the new processes to your marketplace environment. You need to
[use Flex CLI](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/introduction/getting-started-with-flex-cli/)
to do that.

Check the following article:
[Create a new process](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/tutorial/create-transaction-process/#create-a-new-process)

Add _default-booking_ process and alias for it:

```sh
# Create the "default-booking" process
flex-cli process create --path=./ext/transaction-processes/default-booking --process=default-booking --marketplace=yourmarketplaceident-test

# Create "release-1" alias for the process
flex-cli process create-alias --process=default-booking --version=1 --alias=release-1 --marketplace=yourmarketplaceident-test
```

Add _default-purchase_ process and alias for it:

```sh
# Create the "default-purchase" process
flex-cli process create --path=./ext/transaction-processes/default-purchase --process=default-purchase --marketplace=yourmarketplaceident-test

# Create "release-1" alias for the process
flex-cli process create-alias --process=default-purchase --version=1 --alias=release-1 --marketplace=yourmarketplaceident-test
```

### Setup localhost

If you just want to get the app running quickly to test it out, first install
[Node.js](https://nodejs.org/) and [Yarn](https://yarnpkg.com/), and follow along:

```sh
git clone git@github.com:sharetribe/web-template.git  # clone this repository
cd web-template/                                      # change to the cloned directory
yarn install                                          # install dependencies
yarn run config                                       # add the mandatory env vars to your local config
yarn run dev                                          # start the dev server, this will open a browser in localhost:3000
```

You can also follow along the
[Getting started with Sharetribe Web Template](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/introduction/getting-started-with-web-template/)
tutorial in the
[Flex Docs website](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app).

For more information of the configuration, see the
[Environment configuration variables](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/ftw/ftw-env/)
reference in Flex Docs.

### For Windows users

We strongly recommend installing
[Windows Subsystem for Linux](https://docs.microsoft.com/en-us/windows/wsl/about), if you are
developing on Windows. These templates are made for Unix-like web services which is the most common
environment type on host-services for web apps. Also, Flex Docs uses Unix-like commands in articles
instead of DOS commands.

## Getting started with your own customization

If you want to build your own Flex marketplace by customizing the template application, see the
[How to Customize the Template](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/ftw/how-to-customize-ftw/)
guide in Flex Docs.

## Deploying to Heroku

**Note:** Remember to fork the repository before deploying the application. Connecting your own
Github repository to Heroku will make manual deploys easier.

See the
[How to deploy this template to production](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app/ftw/how-to-deploy-ftw-to-production/)
guide in Flex Docs for more information.

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

## Documentation

See the Flex Docs site:
[sharetribe.com/docs/ (preview version)](https://flex-docs-git-feat-docs-biketribe-sharetribe.vercel.app)

> _**Note**: The search does not work on the preview version of the Flex Docs. It links to live
> documentation._

## Get help – join Sharetribe Flex Developer Slack channel

If you have any questions about development, the best place to ask them is the Flex Developer Slack
channel at https://www.sharetribe.com/flex-slack

## License

This project is licensed under the terms of the Apache-2.0 license.

See [LICENSE](LICENSE)
