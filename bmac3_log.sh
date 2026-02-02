#!/bin/bash
tail -5 ~/bmac3.log | tac | sed 's/.*\([0-9][0-9]:[0-9][0-9]:[0-9][0-9]\).*\[\([A-Z]*\)\] /\1 /' | sed 's/, skipped 0 duplicates//'
