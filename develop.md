### Best Practices
We've collected some [best practices](https://github.com/ioBroker/ioBroker.repositories#development-and-coding-best-practices) regarding ioBroker development and coding in general. If you're new to ioBroker or Node.js, you should
check them out. If you're already experienced, you should also take a look at them - you might learn something new :)

### State Roles
When creating state objects, it is important to use the correct role for the state. The role defines how the state should be interpreted by visualizations and other adapters. For a list of available roles and their meanings, please refer to the [state roles documentation](https://www.iobroker.net/#en/documentation/dev/stateroles.md).

**Important:** Do not invent your own custom role names. If you need a role that is not part of the official list, please contact the ioBroker developer community for guidance and discussion about adding new roles.

### Scripts in `package.json`
Several npm scripts are predefined for your convenience. You can run them using `npm run <scriptname>`
| Script name | Description |
|-------------|-------------|
| `test:js` | Executes the tests you defined in `*.test.js` files. |
| `test:package` | Ensures your `package.json` and `io-package.json` are valid. |
| `test:integration` | Tests the adapter startup with an actual instance of ioBroker. |
| `test` | Performs a minimal test run on package files and your tests. |
| `check` | Performs a type-check on your code (without compiling anything). |
| `lint` | Runs `ESLint` to check your code for formatting errors and potential bugs. |
| `translate` | Translates texts in your adapter to all required languages, see [`@iobroker/adapter-dev`](https://github.com/ioBroker/adapter-dev#manage-translations) for more details. |
| `release` | Creates a new release, see [`@alcalzone/release-script`](https://github.com/AlCalzone/release-script#usage) for more details. |

### Writing tests
When done right, testing code is invaluable, because it gives you the
confidence to change your code while knowing exactly if and when
something breaks. A good read on the topic of test-driven development
is https://hackernoon.com/introduction-to-test-driven-development-tdd-61a13bc92d92.
Although writing tests before the code might seem strange at first, but it has very
clear upsides.

The template provides you with basic tests for the adapter startup and package files.
It is recommended that you add your own tests into the mix.

### Publishing the adapter
Using GitHub Actions, you can enable automatic releases on npm whenever you push a new git tag that matches the form
`v<major>.<minor>.<patch>`. We **strongly recommend** that you do. The necessary steps are described in `.github/workflows/test-and-release.yml`.

Since you installed the release script, you can create a new
release simply by calling:
```bash
npm run release
```
Additional command line options for the release script are explained in the
[release-script documentation](https://github.com/AlCalzone/release-script#command-line).

To get your adapter released in ioBroker, please refer to the documentation
of [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories#requirements-for-adapter-to-get-added-to-the-latest-repository).

### Test the adapter manually on a local ioBroker installation
In order to install the adapter locally without publishing, the following steps are recommended:
1. Create a GitHub repository for your adapter if you haven't already
1. Push your code to the GitHub repository
1. Use the ioBroker Admin interface or command line to install the adapter from GitHub:
	* **Via Admin UI**: Go to the "Adapters" tab, click on "Custom Install" (GitHub icon), and enter your repository URL:
		```
		https://github.com/iot-heva/ioBroker.portfolio
		```
		You can also install from a specific branch by adding `#branchname` at the end:
		```
		https://github.com/iot-heva/ioBroker.portfolio#dev
		```
	* **Via Command Line**: Install using the `iob` command:
		```bash
		iob url https://github.com/iot-heva/ioBroker.portfolio
		```
		Or from a specific branch:
		```bash
		iob url https://github.com/iot-heva/ioBroker.portfolio#dev
		```

For later updates:
1. Push your changes to GitHub
1. Repeat the installation steps above (via Admin UI or `iob url` command) to update the adapter