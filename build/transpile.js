// ---------------------------------------------------------------------------
// Usage:
//
//      npm run transpile
// ---------------------------------------------------------------------------

"use strict";

const fs   = require ('fs')
    , {
        replaceInFile,
        logReplaceInFile,
        overwriteFile,
        createFolderRecursively,
        regexAll
    } = require ('./common.js')
    , { basename } = require ('path')
    , log  = require ('ololog')

// ---------------------------------------------------------------------------

const [ /* node */, /* script */, filename ] = process.argv

// ----------------------------------------------------------------------------

const python2Folder = './python/ccxt/'
const python3Folder = './python/ccxt/async_support/'
const phpFolder     = './php/'

// ----------------------------------------------------------------------------

const {
        transpileJavaScriptToPython3,
        transpilePython3ToPython2,
        transpileJavaScriptToPHP,
        transpileJavaScriptToPythonAndPHP,
        transpileDerivedExchangeClass,
    } = require ('./transpiler.js')

// ----------------------------------------------------------------------------

function transpileDerivedExchangeFile (folder, filename) {

    try {

        const contents = fs.readFileSync (folder + filename, 'utf8')

        const { python2, python3, php, className, baseClass } = transpileDerivedExchangeClass (contents)

        const python2Filename = python2Folder + filename.replace ('.js', '.py')
        const python3Filename = python3Folder + filename.replace ('.js', '.py')
        const phpFilename     = phpFolder     + filename.replace ('.js', '.php')

        log.cyan ('Transpiling from', filename.yellow)

        overwriteFile (python2Filename, python2)
        overwriteFile (python3Filename, python3)
        overwriteFile (phpFilename,     php)

        return { className, baseClass }

    } catch (e) {

        log.red ('\nFailed to transpile source code from', filename.yellow)
        log.red ('See https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md on how to build this library properly\n')
        throw e // rethrow it
    }
}

//-----------------------------------------------------------------------------

function transpileDerivedExchangeFiles (folder, pattern = '.js') {

    // exchanges.json accounts for ids included in exchanges.cfg
    const ids = require ('../exchanges.json').ids;

    const classNames = fs.readdirSync (folder)
        .filter (file => file.includes (pattern) && ids.includes (basename (file, pattern)))
        .map (file => transpileDerivedExchangeFile (folder, file))

    if (classNames.length === 0)
        return null

    let classes = {}
    classNames.forEach (({ className, baseClass }) => {
        classes[className] = baseClass
    })

    function deleteOldTranspiledFiles (folder, pattern) {
        fs.readdirSync (folder)
            .filter (file =>
                !fs.lstatSync (folder + file).isDirectory () &&
                file.match (pattern) &&
                !(file.replace (/\.[a-z]+$/, '') in classes) &&
                !file.match (/^Exchange|errors|__init__|\\./))
            .map (file => folder + file)
            .forEach (file => log.red ('Deleting ' + file.yellow) && fs.unlinkSync (file))
    }

    deleteOldTranspiledFiles (python2Folder, /\.pyc?$/)
    deleteOldTranspiledFiles (python3Folder, /\.pyc?$/)
    deleteOldTranspiledFiles (phpFolder, /\.php$/)

    return classes
}

//-----------------------------------------------------------------------------

function transpilePythonAsyncToSync (oldName, newName) {

    log.magenta ('Transpiling ' + oldName.yellow + ' → ' + newName.yellow)
    const fileContents = fs.readFileSync (oldName, 'utf8')
    let lines = fileContents.split ("\n")

    lines = lines.filter (line => ![ 'import asyncio' ].includes (line))
                .map (line => {
                    return (
                        line.replace ('asyncio.get_event_loop().run_until_complete(main())', 'main()')
                            .replace ('import ccxt.async_support as ccxt', 'import ccxt')
                            .replace (/.*token\_bucket.*/g, '')
                            .replace ('await asyncio.sleep', 'time.sleep')
                            .replace ('async ', '')
                            .replace ('await ', ''))
                })

    // lines.forEach (line => log (line))

    function deleteFunction (f, from) {
        const re1 = new RegExp ('def ' + f + '[^\#]+', 'g')
        const re2 = new RegExp ('[\\s]+' + f + '\\(exchange\\)', 'g')
        return from.replace (re1, '').replace (re2, '')
    }

    let newContents = lines.join ('\n')

    newContents = deleteFunction ('test_tickers_async', newContents)
    newContents = deleteFunction ('test_l2_order_books_async', newContents)

    fs.truncateSync (newName)
    fs.writeFileSync (newName, newContents)
}

//-----------------------------------------------------------------------------

function exportTypeScriptDeclarations (classes) {

    const file = './ccxt.d.ts'
    const regex = /(?:    export class [^\s]+ extends [^\s]+ \{\}[\r]?[\n])+/
    const replacement = Object.keys (classes).map (className => {
        const baseClass = classes[className]
        return '    export class ' + className + ' extends ' + baseClass + " {}"
    }).join ("\n") + "\n"

    replaceInFile (file, regex, replacement)
}

//-----------------------------------------------------------------------------

const pyPreamble = "\
import os\n\
import sys\n\
\n\
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))\n\
sys.path.append(root)\n\
\n\
# ----------------------------------------------------------------------------\n\
\n\
# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:\n\
# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code\n\
\n\
# ----------------------------------------------------------------------------\n"

const phpPreamble = "\
<?php\n\
namespace ccxt;\n\
include_once (__DIR__.'/../../ccxt.php');\n\
// ----------------------------------------------------------------------------\n\
\n\
// PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:\n\
// https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code\n\
\n\
// -----------------------------------------------------------------------------\n"

//-----------------------------------------------------------------------------

function transpileDateTimeTests () {
    const jsFile = './js/test/base/functions/test.datetime.js'
    const pyFile = './python/test/test_exchange_datetime_functions.py'
    const phpFile = './php/test/test_exchange_datetime_functions.php'

    log.magenta ('Transpiling from', jsFile.yellow)

    let js = fs.readFileSync (jsFile).toString ()

    js = regexAll (js, [
        [ /[^\n]+require[^\n]+\n/g, '' ],
        [/^\/\*.*\s+/mg, ''],
    ])

    let { python3Body, python2Body, phpBody } = transpileJavaScriptToPythonAndPHP ({ js, removeEmptyLines: false })

    // phpBody = phpBody.replace (/exchange\./g, 'Exchange::')

    const pythonHeader =
"\n\
import ccxt  # noqa: F402\n\
from ccxt.base.decimal_to_precision import ROUND_UP, ROUND_DOWN  # noqa F401\n\
\n\
# ----------------------------------------------------------------------------\n\
\n"

    const python = pyPreamble + pythonHeader + python2Body
    const php = phpPreamble + phpBody

    log.magenta ('→', pyFile.yellow)
    log.magenta ('→', phpFile.yellow)

    overwriteFile (pyFile, python)
    overwriteFile (phpFile, php)
}

//-----------------------------------------------------------------------------

function transpilePrecisionTests () {

    const jsFile = './js/test/base/functions/test.number.js'
    const pyFile = './python/test/test_decimal_to_precision.py'
    const phpFile = './php/test/decimal_to_precision.php'

    log.magenta ('Transpiling from', jsFile.yellow)

    let js = fs.readFileSync (jsFile).toString ()

    js = regexAll (js, [
        [ /\'use strict\';?\s+/g, '' ],
        [ /[^\n]+require[^\n]+\n/g, '' ],
        [ /decimalToPrecision/g, 'decimal_to_precision' ],
        [ /numberToString/g, 'number_to_string' ],
    ])

    let { python3Body, python2Body, phpBody } = transpileJavaScriptToPythonAndPHP ({ js, removeEmptyLines: false })

    const pythonHeader =
"\n\
from ccxt.base.decimal_to_precision import decimal_to_precision  # noqa F401\n\
from ccxt.base.decimal_to_precision import TRUNCATE              # noqa F401\n\
from ccxt.base.decimal_to_precision import ROUND                 # noqa F401\n\
from ccxt.base.decimal_to_precision import DECIMAL_PLACES        # noqa F401\n\
from ccxt.base.decimal_to_precision import SIGNIFICANT_DIGITS    # noqa F401\n\
from ccxt.base.decimal_to_precision import TICK_SIZE             # noqa F401\n\
from ccxt.base.decimal_to_precision import PAD_WITH_ZERO         # noqa F401\n\
from ccxt.base.decimal_to_precision import NO_PADDING            # noqa F401\n\
from ccxt.base.decimal_to_precision import number_to_string      # noqa F401\n\
\n\
# ----------------------------------------------------------------------------\n\
\n\
"

    const phpHeader =
"\
// testDecimalToPrecisionErrorHandling\n\
//\n\
// $this->expectException ('ccxt\\\\BaseError');\n\
// $this->expectExceptionMessageRegExp ('/Negative precision is not yet supported/');\n\
// Exchange::decimalToPrecision ('123456.789', TRUNCATE, -2, DECIMAL_PLACES);\n\
//\n\
// $this->expectException ('ccxt\\\\BaseError');\n\
// $this->expectExceptionMessageRegExp ('/Invalid number/');\n\
// Exchange::decimalToPrecision ('foo');\n\
\n\
// ----------------------------------------------------------------------------\n\
\n\
function decimal_to_precision ($x, $roundingMode = ROUND, $numPrecisionDigits = null, $countingMode = DECIMAL_PLACES, $paddingMode = NO_PADDING) {\n\
    return Exchange::decimal_to_precision ($x, $roundingMode, $numPrecisionDigits, $countingMode, $paddingMode);\n\
}\n\
function number_to_string ($x) {\n\
    return Exchange::number_to_string ($x);\n\
}\n\
"

    const python = pyPreamble + pythonHeader + python2Body
    const php = phpPreamble + phpHeader + phpBody

    log.magenta ('→', pyFile.yellow)
    log.magenta ('→', phpFile.yellow)

    overwriteFile (pyFile, python)
    overwriteFile (phpFile, php)
}

//-----------------------------------------------------------------------------

function transpileCryptoTests () {
    const jsFile = './js/test/base/functions/test.crypto.js'
    const pyFile = './python/test/test_crypto.py'
    const phpFile = './php/test/test_crypto.php'

    log.magenta ('Transpiling from', jsFile.yellow)
    let js = fs.readFileSync (jsFile).toString ()

    js = regexAll (js, [
        [ /\'use strict\';?\s+/g, '' ],
        [ /[^\n]+require[^\n]+\n/g, '' ],
        [ /function equals \([\S\s]+?return true\n}\n/g, '' ],
    ])

    let { python3Body, python2Body, phpBody } = transpileJavaScriptToPythonAndPHP ({ js, removeEmptyLines: false })

    const pythonHeader = `
import ccxt  # noqa: F402

Exchange = ccxt.Exchange
hash = Exchange.hash
ecdsa = Exchange.ecdsa
jwt = Exchange.jwt
encode = Exchange.encode


def equals(a, b):
    return a == b
`
    const phpHeader = `
function hash(...$args) {
    return Exchange::hash(...$args);
}

function encode(...$args) {
    return Exchange::encode(...$args);
}

function ecdsa(...$args) {
    return Exchange::ecdsa(...$args);
}

function jwt(...$args) {
    return Exchange::jwt(...$args);
}

function equals($a, $b) {
    return $a === $b;
}`

    const python = pyPreamble + pythonHeader + python2Body
    const php = phpPreamble + phpHeader + phpBody

    log.magenta ('→', pyFile.yellow)
    log.magenta ('→', phpFile.yellow)

    overwriteFile (pyFile, python)
    overwriteFile (phpFile, php)
}

//-----------------------------------------------------------------------------

function transpileErrorHierarchy () {

    const errorHierarchyFilename = './js/base/errorHierarchy.js'

    let js = fs.readFileSync (errorHierarchyFilename, 'utf8')

    js = regexAll (js, [
        [ /module\.exports = [^\;]+\;\n/s, '' ],
    ]).trim ()

    const { python3Body, phpBody } = transpileJavaScriptToPythonAndPHP ({ js })

    const message = 'Transpiling error hierachy →'
    logReplaceInFile (message, './python/ccxt/base/errors.py', /error_hierarchy = .+?\n\}/s, python3Body)
    logReplaceInFile (message, './php/errors.php',             /\$error_hierarchy = .+?\n\)\;/s, phpBody)
}

//-----------------------------------------------------------------------------

createFolderRecursively (python2Folder)
createFolderRecursively (python3Folder)
createFolderRecursively (phpFolder)


const classes = transpileDerivedExchangeFiles ('./js/', filename)

if (classes === null) {
    log.bright.yellow ('0 files transpiled.')
    return;
}

// HINT: if we're going to support specific class definitions this process won't work anymore as it will override the definitions.
exportTypeScriptDeclarations (classes)  // we use typescript?

transpileErrorHierarchy ()
transpilePrecisionTests ()
transpileDateTimeTests ()
transpileCryptoTests ()
transpilePythonAsyncToSync ('./python/test/test_async.py', './python/test/test.py')

//-----------------------------------------------------------------------------

log.bright.green ('Transpiled successfully.')